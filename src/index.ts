import 'reflect-metadata';
import { WhatsAppProxyApp } from './app.js';
import { config } from './config.js';

const app = await WhatsAppProxyApp.create(config);

await app.start();

const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[index] ${signal} recibido. Apagando...`);
    await app.stop();
    process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
