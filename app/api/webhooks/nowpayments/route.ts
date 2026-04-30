import { NextResponse } from 'next/server';
import { Client } from '@upstash/qstash';
import { nowpayments } from '@/lib/payments/nowpayments';

const qstash = new Client({ token: process.env.QSTASH_TOKEN || '' });

export async function POST(req: Request) {
  try {
    const signature = req.headers.get('x-nowpayments-sig');
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    const rawBody = await req.text();
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Verificamos la firma criptográfica para asegurar que vino de NOWPayments
    const isValid = nowpayments.verifyIpnSignature(payload, signature);
    if (!isValid) {
      console.error('Invalid NOWPayments signature for payload:', payload);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const paymentId = payload.payment_id?.toString();
    const paymentStatus = payload.payment_status;

    if (!paymentId) {
      return NextResponse.json({ error: 'Missing payment_id' }, { status: 400 });
    }

    // Enviar a la cola de procesamiento (QStash)
    // Esto garantiza: 1. Idempotencia (cero duplicados) 2. Tolerancia a fallos 3. Vercel timeout avoidance
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const workerUrl = `${appUrl}/api/queue/process-saas-payment`;

    await qstash.publishJSON({
      url: workerUrl,
      body: payload,
      headers: {
        'Upstash-Deduplication-Id': `${paymentId}_${paymentStatus}`, // Evita procesar el mismo estado del mismo pago > 1 vez
      },
    });

    // NOWPayments requiere un 200 OK inmediatamente
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
