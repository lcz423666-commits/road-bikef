const buildPayload = (text: string) => ({
  msg_type: "text",
  content: { text },
});

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const webhook = process.env.FEISHU_WEBHOOK;
  if (!webhook) {
    res.status(500).send("Missing FEISHU_WEBHOOK");
    return;
  }

  const text = typeof req.body?.text === "string" ? req.body.text : null;
  if (!text) {
    res.status(400).send("Invalid payload");
    return;
  }

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload(text)),
  });

  if (!response.ok) {
    const errText = await response.text();
    res.status(response.status).send(errText);
    return;
  }

  res.status(200).send("ok");
}
