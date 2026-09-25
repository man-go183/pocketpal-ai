import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface LocalApiRequest {
  id: string;
  method: string;
  path: string;
  body: string;
}

export interface Spec extends TurboModule {
  start(port: number): Promise<string>;
  stop(): void;
  takeNext(timeoutMs: number): Promise<LocalApiRequest | null>;
  respond(id: string, code: number, body: string): void;
  getStatus(): Promise<{running: boolean; port: number}>;
  getWifiIp(): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('LocalApiModule');
