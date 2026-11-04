import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { criarFonteGPSNativa } from './nativeGPS.js';

// Nenhum acesso à localização acontece ao importar ou criar esta fábrica.
export const criarFonteGPSReal = handlers => criarFonteGPSNativa({ ...handlers, location: Location, appState: AppState });
