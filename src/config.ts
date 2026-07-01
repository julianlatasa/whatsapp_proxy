import 'dotenv/config';

export interface AppConfig {
    dbPath: string;
    authDir: string;
    browserName: string;
    wsPort: number;
    callRejectionMessage: string;
}

function loadConfig(): AppConfig {
    return {
        dbPath: process.env.DB_PATH ?? './data/messages.db',
        authDir: process.env.AUTH_DIR ?? './auth_info_baileys',
        browserName: process.env.BROWSER_NAME ?? 'WhatsAppProxy',
        wsPort: Number(process.env.WS_PORT ?? 8081),
        callRejectionMessage: process.env.CALL_REJECTION_MESSAGE ?? 'Esta línea es solo para mensajes y no admite llamadas.',
    };
}

export const config: AppConfig = loadConfig();
