package com.pocketpal.localapi

import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeLocalApiSpec
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private data class PendingRequest(
    val id: String,
    val method: String,
    val path: String,
    val body: String,
    val reply: LinkedBlockingQueue<Triple<Int, String, Boolean>> = LinkedBlockingQueue(1),
)

@ReactModule(name = NativeLocalApiSpec.NAME)
class LocalApiModule(reactContext: ReactApplicationContext) :
    NativeLocalApiSpec(reactContext) {

  private val pending = ConcurrentLinkedQueue<PendingRequest>()
  private val byId = ConcurrentHashMap<String, PendingRequest>()
  private val running = AtomicBoolean(false)
  private var serverSocket: ServerSocket? = null
  private var acceptThread: Thread? = null
  private var boundPort: Int = 0

  override fun getName(): String = NativeLocalApiSpec.NAME

  fun startWithPort(wanted: Int, promise: Promise) {
    if (running.get()) {
      promise.resolve("already running on port $boundPort")
      return
    }
    try {
      val ss = ServerSocket(wanted, 8)
      boundPort = ss.localPort
      serverSocket = ss
      running.set(true)
      acceptThread =
          Thread({
            while (running.get()) {
              try {
                val socket = ss.accept()
                Thread({ handleConnection(socket) }).apply {
                  isDaemon = true
                  start()
                }
              } catch (e: Exception) {
                if (running.get()) e.printStackTrace()
              }
            }
          }).apply {
            isDaemon = true
            start()
          }
      promise.resolve("listening on 127.0.0.1:$boundPort")
    } catch (e: Exception) {
      promise.reject("START_FAILED", e.message)
    }
  }

  override fun start(port: Double, promise: Promise) {
    startWithPort(port.toInt(), promise)
  }

  override fun stop() {
    running.set(false)
    try {
      serverSocket?.close()
    } catch (e: Exception) {
    }
    serverSocket = null
    acceptThread = null
  }

  override fun takeNext(timeoutMs: Double, promise: Promise) {
    val deadline = System.currentTimeMillis() + timeoutMs.toLong()
    var req: PendingRequest? = null
    while (System.currentTimeMillis() < deadline && req == null) {
      req = pending.poll()
      if (req == null) {
        try {
          Thread.sleep(50)
        } catch (e: InterruptedException) {
          break
        }
      }
    }
    if (req == null) {
      promise.resolve(null)
      return
    }
    val map = Arguments.createMap()
    map.putString("id", req.id)
    map.putString("method", req.method)
    map.putString("path", req.path)
    map.putString("body", req.body)
    promise.resolve(map)
  }

  override fun respond(id: String, code: Double, body: String) {
    val req = byId.remove(id) ?: return
    req.reply.offer(Triple(code.toInt(), body, true))
  }

  override fun getStatus(promise: Promise) {
    val map = Arguments.createMap()
    map.putBoolean("running", running.get())
    map.putInt("port", boundPort)
    promise.resolve(map)
  }

  override fun getWifiIp(promise: Promise) {
    try {
      val wm =
          reactApplicationContext.getSystemService(android.content.Context.WIFI_SERVICE) as
              android.net.wifi.WifiManager
      val ip = wm.connectionInfo?.ipAddress ?: 0
      if (ip == 0) {
        promise.resolve("")
        return
      }
      promise.resolve(
          "${ip and 0xff}.${ip shr 8 and 0xff}.${ip shr 16 and 0xff}.${ip shr 24 and 0xff}")
    } catch (e: Exception) {
      promise.resolve("")
    }
  }

  private fun handleConnection(socket: Socket) {
    try {
      socket.soTimeout = 30000
      val input = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
      val requestLine = input.readLine() ?: run { socket.close(); return }
      val parts = requestLine.split(" ")
      if (parts.size < 2) run { socket.close(); return }
      val method = parts[0].uppercase()
      var path = parts[1].split("?")[0]
      var contentLength = 0
      while (true) {
        val line = input.readLine() ?: break
        if (line.isEmpty()) break
        val idx = line.indexOf(":")
        if (idx > 0 && line.substring(0, idx).trim().equals("Content-Length", ignoreCase = true)) {
          contentLength = line.substring(idx + 1).trim().toIntOrNull() ?: 0
        }
      }
      val bodyChars = CharArray(contentLength.coerceAtLeast(0))
      var read = 0
      while (read < contentLength) {
        val n = input.read(bodyChars, read, contentLength - read)
        if (n < 0) break
        read += n
      }
      val body = String(bodyChars, 0, read)
      if (path != "/v1/models" && path != "/v1/chat/completions") {
        writeResponse(socket.getOutputStream(), 404, "{\"error\":\"not found\"}")
        socket.close()
        return
      }
      if (method != "GET" && method != "POST") {
        writeResponse(socket.getOutputStream(), 405, "{\"error\":\"method not allowed\"}")
        socket.close()
        return
      }
      val req = PendingRequest(UUID.randomUUID().toString(), method, path, body)
      byId[req.id] = req
      pending.offer(req)
      val resp = req.reply.poll(120, TimeUnit.SECONDS)
      byId.remove(req.id)
      if (resp == null) {
        writeResponse(socket.getOutputStream(), 504, "{\"error\":\"inference timeout\"}")
      } else {
        writeResponse(socket.getOutputStream(), resp.first, resp.second)
      }
      socket.close()
    } catch (e: Exception) {
      try {
        socket.close()
      } catch (ignored: Exception) {
      }
    }
  }

  private fun writeResponse(out: OutputStream, code: Int, body: String) {
    val bytes = body.toByteArray(Charsets.UTF_8)
    val head =
        "HTTP/1.1 $code ${reasonFor(code)}\r\n" +
            "Content-Type: application/json\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Connection: close\r\n\r\n"
    out.write(head.toByteArray(Charsets.UTF_8))
    out.write(bytes)
    out.flush()
  }

  private fun reasonFor(code: Int): String =
      when (code) {
        200 -> "OK"
        404 -> "Not Found"
        405 -> "Method Not Allowed"
        504 -> "Gateway Timeout"
        else -> "OK"
      }

  companion object {
    const val DEFAULT_PORT = 12345
  }
}
