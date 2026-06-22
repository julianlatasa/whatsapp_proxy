import 'dotenv/config';

export interface AppConfig {
    dbPath: string;
    authDir: string;
    browserName: string;
    wsPort: number;
}

function loadConfig(): AppConfig {
    return {
        dbPath: process.env.DB_PATH ?? './data/messages.db',
        authDir: process.env.AUTH_DIR ?? './auth_info_baileys',
        browserName: process.env.BROWSER_NAME ?? 'WhatsAppProxy',
        wsPort: Number(process.env.WS_PORT ?? 8081),
    };
}

export const config: AppConfig = loadConfig();
