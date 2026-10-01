import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://ceqjgbktfcjdfasfolhg.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; 

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const event = req.body;

    if (event.type === 'payment' || event.action === 'payment.created') {
      const paymentId = event.data?.id || event.id;

      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      });

      const paymentData = await mpResponse.json();

      if (paymentData.status === 'approved') {
        const email = paymentData.payer?.email || paymentData.metadata?.user_email;
        const externalReference = paymentData.external_reference;

        if (email || externalReference) {
          let nuevoPlan = 'docente';
          const transactionAmount = paymentData.transaction_amount;

          if (transactionAmount >= 20000) {
            nuevoPlan = 'institucion';
          } else if (transactionAmount >= 8000) {
            nuevoPlan = 'profesional';
          }

          const query = externalReference 
            ? supabaseAdmin.from('profiles').update({ plan: nuevoPlan }).eq('id', externalReference)
            : supabaseAdmin.from('profiles').update({ plan: nuevoPlan }).eq('email', email);

          const { error: updateError } = await query;

          if (updateError) {
            console.error('Error al actualizar plan en Supabase:', updateError);
            return res.status(500).json({ error: 'Error interno de base de datos' });
          }
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error en Webhook:', error);
    return res.status(500).json({ error: error.message });
  }
}
