/** Binding nativo; ciclo de vida/cache ficam no serviço testável. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import embeddedSnapshot from '../data/network.snapshot.json';
import { MobileNetworkServiceCore } from './mobileNetworkServiceCore.js';
export { fingerprintOf } from './mobileNetworkServiceCore.js';
export class MobileNetworkService extends MobileNetworkServiceCore {
  constructor(options = {}) {
    super({ ...options, storage: options.storage ?? AsyncStorage,
      embeddedSnapshot: options.embeddedSnapshot ?? embeddedSnapshot });
  }
}
export const mobileNetworkService = new MobileNetworkService();
