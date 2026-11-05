import { testarEnderecos } from '../../test/cenariosEnderecoUI.js';
import { criarRevisoesEndereco } from '../src/utils/revisoesEndereco.js';
testarEnderecos('APK',criarRevisoesEndereco,process.env.SIGA_APK_SOURCE || new URL('../App.js',import.meta.url));
