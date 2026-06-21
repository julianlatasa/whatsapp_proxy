import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConsoleLoggerObserver } from './observers/console-logger.observer.js';
import { ContactRegistryObserver } from './observers/contact-registry.observer.js';
import { PersistenceObserver } from './observers/persistence.observer.js';
import { MessageFactory } from './patterns/message.factory.js';
import { BlockedContactRepository } from './storage/blocked-contact.repository.js';
import { ContactRepository } from './storage/contact.repository.js';
import { DatabaseConnection } from './storage/database.js';
import { MessageRepository } from './storage/message.repository.js';
import type { StoredBlockedContact } from './types/blocked-contact.types.js';
import type { ListMessagesOptions, StoredMessage } from './types/message.types.js';
import { ConnectionStatus, WhatsAppClient } from './whatsapp/whatsapp.client.js';
import { WsServer } from './ws/ws.server.js';

export interface WhatsAppProxyAppOptions {
    dbPath: string;
    authDir: string;
    browserName?: string;
    wsPort: number;
}

/**
 * Patrón Facade: expone una API simple (start/stop/sendMessage/getMessages)
 * ocultando la coordinación entre WhatsAppClient, MessageRepository y los
 * observadores suscritos a los eventos del cliente.
 */
export class WhatsAppProxyApp {
    readonly client: WhatsAppClient;

    private readonly repository: MessageRepository;
    private readonly blockedContacts: BlockedContactRepository;
    private readonly wsServer: WsServer;

    constructor(options: WhatsAppProxyAppOptions) {
        mkdirSync(dirname(options.dbPath), { recursive: true });

        const db = DatabaseConnection.getInstance(options.dbPath);
        this.repository = new MessageRepository(db);
        this.blockedContacts = new BlockedContactRepository(db);
        const contactRepository = new ContactRepository(db);
        this.client = new WhatsAppClient({ authDir: options.authDir, browserName: options.browserName });

        new ConsoleLoggerObserver(this.client);
        const persistenceObserver = new PersistenceObserver(this.client, this.repository, this.blockedContacts);
        new ContactRegistryObserver(this.client, contactRepository);

        this.wsServer = new WsServer({
            port: options.wsPort,
            client: this.client,
            messageRepository: this.repository,
            contactRepository,
            blockedContactRepository: this.blockedContacts,
            persistenceObserver,
            logout: () => this.logout(),
        });
    }

    async start(): Promise<void> {
        await this.client.connect();
    }

    async stop(): Promise<void> {
        this.wsServer.close();
        await this.client.disconnect();
        DatabaseConnection.close();
    }

    /** Cierra la sesión de WhatsApp y limpia las credenciales guardadas; al reconectar se pedirá un QR nuevo. */
    async logout(): Promise<void> {
        await this.client.forceLogout();
    }

    /** Envía un mensaje de texto y lo persiste como saliente (`fromMe: true`). */
    async sendMessage(jid: string, text: string): Promise<StoredMessage> {
        const draft = MessageFactory.createOutboundText(jid, text);
        const waMessageId = await this.client.sendText(jid, text, draft.id);

        const saved = this.repository.save({ ...draft, id: waMessageId ?? draft.id });
        if (!saved) {
            throw new Error(`No se pudo persistir el mensaje enviado: ${draft.id}`);
        }

        return saved;
    }

    getMessages(options: ListMessagesOptions = {}): StoredMessage[] {
        return this.repository.list(options);
    }

    /** Bloquea un contacto por jid (s.whatsapp.net) y/o lid. Los mensajes que llegue de él se descartan. */
    blockContact(jid: string | null, lid: string | null): StoredBlockedContact | null {
        return this.blockedContacts.block({ jid, lid });
    }

    unblockContact(jid: string | null, lid: string | null): void {
        this.blockedContacts.unblock(jid, lid);
    }

    getBlockedContacts(): StoredBlockedContact[] {
        return this.blockedContacts.list();
    }
}

export { ConnectionStatus };
