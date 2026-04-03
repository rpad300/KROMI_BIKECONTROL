/**
 * ServiceNotificationService — email + in-app notifications for service events
 * Uses Gemini to generate contextual email content
 */

const GEMINI_KEY = (import.meta.env.VITE_GEMINI_API_KEY ?? import.meta.env.VITE_GOOGLE_MAPS_API_KEY) as string | undefined;

export type NotificationEvent =
  | 'service_requested'      // rider → shop
  | 'service_accepted'       // shop → rider
  | 'service_started'        // shop → rider
  | 'approval_needed'        // mechanic → rider (found extra issue)
  | 'approval_response'      // rider → mechanic
  | 'service_completed'      // shop → rider
  | 'service_comment'        // either direction
  | 'maintenance_due';       // system → rider (wear alert)

interface NotificationData {
  event: NotificationEvent;
  service_title?: string;
  bike_name?: string;
  shop_name?: string;
  mechanic_name?: string;
  rider_name?: string;
  rider_email?: string;
  shop_email?: string;
  item_description?: string;
  item_cost?: number;
  comment_body?: string;
  component_type?: string;
  wear_pct?: number;
}

/** Generate email subject + body using Gemini */
async function generateEmailContent(data: NotificationData): Promise<{ subject: string; body: string } | null> {
  if (!GEMINI_KEY) return getStaticTemplate(data);

  try {
    const prompt = `Gera um email curto em português (Portugal) para uma notificação de serviço de bicicleta.

Evento: ${data.event}
${data.service_title ? `Serviço: ${data.service_title}` : ''}
${data.bike_name ? `Bike: ${data.bike_name}` : ''}
${data.shop_name ? `Oficina: ${data.shop_name}` : ''}
${data.mechanic_name ? `Mecânico: ${data.mechanic_name}` : ''}
${data.item_description ? `Item: ${data.item_description} (${data.item_cost ?? 0}€)` : ''}
${data.comment_body ? `Comentário: ${data.comment_body}` : ''}
${data.component_type ? `Componente: ${data.component_type} (${data.wear_pct}% desgaste)` : ''}

Responde APENAS com JSON: {"subject": "...", "body": "..."}
O body deve ser texto simples (não HTML), 3-5 linhas, profissional mas amigável. Inclui assinatura "KROMI BikeControl".`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
      }),
    });

    const result = await res.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* fallback */ }

  return getStaticTemplate(data);
}

/** Static fallback templates when AI is unavailable */
function getStaticTemplate(data: NotificationData): { subject: string; body: string } {
  const templates: Record<NotificationEvent, { subject: string; body: string }> = {
    service_requested: {
      subject: `Novo pedido de serviço: ${data.service_title}`,
      body: `Olá,\n\nFoi recebido um novo pedido de serviço para a bike "${data.bike_name}".\nServiço: ${data.service_title}\n\nPor favor confirme a marcação no KROMI BikeControl.\n\n— KROMI BikeControl`,
    },
    service_accepted: {
      subject: `Serviço aceite: ${data.service_title}`,
      body: `Olá,\n\nA oficina ${data.shop_name} aceitou o teu pedido de serviço "${data.service_title}" para a bike "${data.bike_name}".\n\nAcompanha o progresso no KROMI BikeControl.\n\n— KROMI BikeControl`,
    },
    service_started: {
      subject: `Trabalho iniciado: ${data.service_title}`,
      body: `Olá,\n\nO mecânico começou a trabalhar no serviço "${data.service_title}" da tua bike "${data.bike_name}".\n\n— KROMI BikeControl`,
    },
    approval_needed: {
      subject: `Aprovação necessária: ${data.item_description}`,
      body: `Olá,\n\nDurante o serviço "${data.service_title}", o mecânico detectou um item adicional que precisa da tua aprovação:\n\n${data.item_description} — ${data.item_cost ?? 0}€\n\nPor favor aprova ou rejeita no KROMI BikeControl.\n\n— KROMI BikeControl`,
    },
    approval_response: {
      subject: `Resposta a aprovação: ${data.service_title}`,
      body: `Olá,\n\nO proprietário respondeu ao pedido de aprovação do serviço "${data.service_title}".\n\nVerifica os detalhes no KROMI BikeControl.\n\n— KROMI BikeControl`,
    },
    service_completed: {
      subject: `Serviço concluído: ${data.service_title}`,
      body: `Olá,\n\nO serviço "${data.service_title}" da bike "${data.bike_name}" foi concluído pela oficina ${data.shop_name}.\n\nA tua bike está pronta para levantar!\n\n— KROMI BikeControl`,
    },
    service_comment: {
      subject: `Nova mensagem: ${data.service_title}`,
      body: `Olá,\n\nNova mensagem no serviço "${data.service_title}":\n\n"${data.comment_body}"\n\nResponde no KROMI BikeControl.\n\n— KROMI BikeControl`,
    },
    maintenance_due: {
      subject: `Manutenção necessária: ${data.component_type}`,
      body: `Olá,\n\nO componente "${data.component_type}" da bike "${data.bike_name}" atingiu ${data.wear_pct}% de desgaste.\n\nRecomendamos agendar uma manutenção em breve.\n\n— KROMI BikeControl`,
    },
  };

  return templates[data.event] ?? { subject: 'Notificação KROMI', body: 'Tens uma nova notificação no KROMI BikeControl.' };
}

/** Send notification — generates content via AI and logs to service_comments */
export async function sendServiceNotification(data: NotificationData): Promise<void> {
  const content = await generateEmailContent(data);
  if (!content) return;

  // Log the notification as a system comment (for audit trail)
  // The actual email sending would use Resend or similar
  // For now we store it — email integration via Supabase Edge Function
  console.log(`[Notification] ${data.event}:`, content.subject);

  // TODO: Resend API integration
  // await fetch('https://api.resend.com/emails', {
  //   method: 'POST',
  //   headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     from: 'KROMI BikeControl <noreply@kromi.online>',
  //     to: data.rider_email ?? data.shop_email,
  //     subject: content.subject,
  //     text: content.body,
  //   }),
  // });
}
