import { testarEnderecos } from './cenariosEnderecoUI.js';
import { criarRevisoesEndereco } from '../public/revisoesEndereco.js';
testarEnderecos('Web',criarRevisoesEndereco,process.env.SIGA_WEB_SOURCE || new URL('../public/app.js',import.meta.url));
