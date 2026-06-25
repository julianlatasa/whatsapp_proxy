import { ConsoleLoggerObserver } from './observers/console-logger.observer.js';
import { ContactLidReconciliationObserver } from './observers/contact-lid-reconciliation.observer.js';
import { ContactRegistryObserver } from './observers/contact-registry.observer.js';
import { PersistenceObserver } from './observers/persistence.observer.js';
import { UnsupportedTypeNotifierObserver } from './observers/unsupported-type-notifier.observer.js';
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

    private constructor(
        client: WhatsAppClient,
        repository: MessageRepository,
        blockedContacts: BlockedContactRepository,
        contactRepository: ContactRepository,
        wsPort: number
    ) {
        this.client = client;
        this.repository = repository;
        this.blockedContacts = blockedContacts;

        new ConsoleLoggerObserver(this.client);
        new UnsupportedTypeNotifierObserver(this.client);
        const persistenceObserver = new PersistenceObserver(this.client, this.repository, this.blockedContacts);
        new ContactRegistryObserver(this.client, contactRepository);
        new ContactLidReconciliationObserver(this.client, contactRepository);

        this.wsServer = new WsServer({
            port: wsPort,
            client: this.client,
            messageRepository: this.repository,
            contactRepository,
            blockedContactRepository: this.blockedContacts,
            persistenceObserver,
            logout: () => this.logout(),
        });
    }

    static async create(options: WhatsAppProxyAppOptions): Promise<WhatsAppProxyApp> {
        const db = await DatabaseConnection.getInstance(options.dbPath);

        const repository = new MessageRepository(db);
        const blockedContacts = new BlockedContactRepository(db);
        const contactRepository = new ContactRepository(db);
        const client = new WhatsAppClient({ authDir: options.authDir, browserName: options.browserName });

        return new WhatsAppProxyApp(client, repository, blockedContacts, contactRepository, options.wsPort);
    }

    async start(): Promise<void> {
        await this.client.connect();
    }

    async stop(): Promise<void> {
        this.wsServer.close();
        await this.client.disconnect();
        await DatabaseConnection.close();
    }

    /** Cierra la sesión de WhatsApp y limpia las credenciales guardadas; al reconectar se pedirá un QR nuevo. */
    async logout(): Promise<void> {
        await this.client.forceLogout();
    }

    /** Envía un mensaje de texto y lo persiste como saliente (`fromMe: true`). */
    async sendMessage(jid: string, text: string): Promise<StoredMessage> {
        const draft = MessageFactory.createOutboundText(jid, text);
        await this.repository.save(draft);

        const sent = await this.client.sendText(jid, text, draft.id);
        const finalId = sent?.key?.id ?? draft.id;
        console.log(`[app] Mensaje enviado: draft.id=${draft.id} sent.key.id=${sent?.key?.id ?? '(sin respuesta)'} -> finalId=${finalId}`);
        if (finalId !== draft.id) {
            console.warn(`[app] WhatsApp devolvió un id distinto al forzado: draft=${draft.id} final=${finalId}`);
        }
        await this.repository.markSent(draft.id, finalId, sent ?? null);
        console.log(`[app] Mensaje persistido en DB con id=${finalId} (status=sent).`);

        const saved = await this.repository.findById(finalId);
        if (!saved) {
            throw new Error(`No se pudo persistir el mensaje enviado: ${draft.id}`);
        }

        return saved;
    }

    async getMessages(options: ListMessagesOptions = {}): Promise<StoredMessage[]> {
        return this.repository.list(options);
    }

    /** Bloquea un contacto por jid (s.whatsapp.net) y/o lid. Los mensajes que llegue de él se descartan. */
    async blockContact(jid: string | null, lid: string | null): Promise<StoredBlockedContact | null> {
        return this.blockedContacts.block({ jid, lid });
    }

    async unblockContact(jid: string | null, lid: string | null): Promise<void> {
        await this.blockedContacts.unblock(jid, lid);
    }

    async getBlockedContacts(): Promise<StoredBlockedContact[]> {
        return this.blockedContacts.list();
    }
}

export { ConnectionStatus };
