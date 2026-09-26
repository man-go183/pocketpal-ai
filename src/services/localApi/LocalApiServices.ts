import {modelStore} from '../../store';

function getNative(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('../../specs/NativeLocalApi');
    return m && m.default ? m.default : m;
  } catch (e) {
    return null;
  }
}

type OaiMessage = {role: string; content: any};

class LocalApiService {
  running = false;
  port = 0;
  statusText = 'stopped';
  private loopActive = false;

  async start(port = 12345): Promise<string> {
    const native = getNative();
    if (!native) {
      throw new Error('Local API module not available on this platform');
    }
    const msg = await native.start(port);
    const st = await native.getStatus();
    this.running = !!st.running;
    this.port = st.port;
    let wifiPart = '';
    try {
      const ip = await native.getWifiIp();
      if (ip) {
        wifiPart = ` • wifi: ${ip}:${this.port}`;
      }
    } catch (e) {}
    this.statusText = this.running
      ? `listening on 127.0.0.1:${this.port}${wifiPart}`
      : 'stopped';
    if (this.running && !this.loopActive) {
      this.loopActive = true;
      this.loop().finally(() => {
        this.loopActive = false;
      });
    }
    return String(msg);
  }

  async stop(): Promise<void> {
    try {
      await getNative()?.stop();
    } catch (e) {}
    this.running = false;
    this.port = 0;
    this.statusText = 'stopped';
  }

  private async loop(): Promise<void> {
    const native = getNative();
    if (!native) {
      return;
    }
    while (this.running) {
      let req: any = null;
      try {
        req = await native.takeNext(15000);
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      if (!req) {
        continue;
      }
      try {
        const {code, body} = await this.handle(req);
        native.respond(String(req.id), code, body);
      } catch (e: any) {
        try {
          native.respond(
            String(req.id),
            500,
            JSON.stringify({error: e?.message || 'internal error'}),
          );
        } catch (ignored) {}
      }
    }
  }

  private async handle(req: {
    method: string;
    path: string;
    body: string;
  }): Promise<{code: number; body: string}> {
    if (req.path === '/v1/models') {
      const modelId = this.activeModelId();
      return {
        code: 200,
        body: JSON.stringify({
          object: 'list',
          data: modelId
            ? [
                {
                  id: modelId,
                  object: 'model',
                  created: Date.now(),
                  owned_by: 'pocketpal-local',
                },
              ]
            : [],
        }),
      };
    }
    if (req.path === '/v1/chat/completions' && req.method === 'POST') {
      let payload: any = {};
      try {
        payload = JSON.parse(req.body || '{}');
      } catch (e) {
        return {code: 400, body: JSON.stringify({error: 'invalid JSON'})};
      }
      if (payload.stream) {
        return {
          code: 400,
          body: JSON.stringify({
            error: 'streaming not supported by this endpoint, use stream:false',
          }),
        };
      }
      const engine = (modelStore as any)?.engine;
      if (!engine) {
        return {
          code: 503,
          body: JSON.stringify({error: 'no local model loaded'}),
        };
      }
      const messages: OaiMessage[] = Array.isArray(payload.messages)
        ? payload.messages
        : [{role: 'user', content: String(payload.prompt || '')}];
      const params: any = {
        messages,
        reasoning_format: 'auto',
      };
      if (typeof payload.temperature === 'number') {
        params.temperature = payload.temperature;
      }
      if (typeof payload.top_p === 'number') {
        params.top_p = payload.top_p;
      }
      if (typeof payload.max_tokens === 'number') {
        params.n_predict = payload.max_tokens;
      } else {
        params.n_predict = 512;
      }
      if (Array.isArray(payload.stop)) {
        params.stop = payload.stop;
      }
      const result = await engine.completion(params);
      const text =
        typeof result?.content === 'string' && result.content.length > 0
          ? result.content
          : String(result?.text || '');
      return {
        code: 200,
        body: JSON.stringify({
          id: 'chatcmpl-local-' + Date.now(),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: payload.model || this.activeModelId() || 'local',
          choices: [
            {
              index: 0,
              message: {role: 'assistant', content: text},
              finish_reason: result?.stopped_eos === false ? 'length' : 'stop',
            },
          ],
          usage: {
            prompt_tokens: result?.tokens_evaluated || 0,
            completion_tokens: result?.tokens_predicted || 0,
            total_tokens:
              (result?.tokens_evaluated || 0) + (result?.tokens_predicted || 0),
          },
        }),
      };
    }
    return {code: 404, body: JSON.stringify({error: 'not found'})};
  }

  private activeModelId(): string {
    try {
      const m = (modelStore as any)?.activeModel;
      const id = m?.id || m?.modelId;
      return id ? String(id) : '';
    } catch (e) {
      return '';
    }
  }
}

export const localApiService = new LocalApiService();
