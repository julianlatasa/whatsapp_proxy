import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { WebSocket } from 'ws';

const WS_URL = process.env.WS_URL ?? 'ws://localhost:8081';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const numero = (await rl.question('Numero (sin @s.whatsapp.net): ')).trim();
const texto = (await rl.question('Texto a enviar: ')).trim();
rl.close();

const jid = `${numero}@s.whatsapp.net`;
const socket = new WebSocket(WS_URL);
let sentMessageId = null;

socket.on('open', () => {
    console.log(`[conectado] ${WS_URL}`);

    const request = { type: 'send.message', id: randomUUID(), payload: { jid, text: texto } };
    console.log('[enviando]', JSON.stringify(request));
    socket.send(JSON.stringify(request));
});

socket.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    console.log('[recibido]', JSON.stringify(frame, null, 2));

    if (frame.type === 'send.message.ok') {
        sentMessageId = frame.payload.id;
        console.log(`[info] mensaje enviado, id=${sentMessageId}. Esperando confirmación de entrega...`);
    }

    if (frame.type === 'send.message.error') {
        socket.close();
    }

    if (frame.type === 'message.status-changed' && frame.payload.id === sentMessageId && frame.payload.status === 'delivered') {
        console.log(`[entregado] lid=${frame.payload.lid} jid=${frame.payload.jid}`);
        socket.close();
    }
});

socket.on('close', (code, reason) => {
    console.log(`[cerrado] code=${code} reason=${reason.toString()}`);
    process.exit(0);
});

socket.on('error', (error) => {
    console.error('[error]', error.message);
    process.exit(1);
});
