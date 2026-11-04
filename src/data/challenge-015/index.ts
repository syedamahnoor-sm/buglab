/*
 * Challenge 015: Every Message Arrives Twice. Learner-visible content only;
 * the answer key is in answer-key.server.ts and must not be imported here.
 * Code comments read like normal engineering comments and never name the defect.
 */
import { defineChallenge } from "@/lib/authoring/define-challenge";

const DATE = "2026-10-25";
const BODY = '{"email":"sam.lee@example.com","topic":"billing","message":"I was charged for two seats but only use one."}';

export const challenge015 = defineChallenge({
  number: "015",
  title: "Every Message Arrives Twice",
  incident: "Each message sent through the contact form creates two support tickets.",
  difficulty: "beginner",
  tags: ["React", "Forms", "Events"],
  estimatedMinutes: 15,
  description:
    "Since the contact page was rebuilt, support receives every message twice, with two ticket numbers and two confirmation emails. Customers swear they clicked once.",
  category: "frontend",
  technologies: ["TypeScript", "React", "Node.js"],
  publishedAt: "2026-11-04",
  incidentDate: DATE,
  origin: "https://help.orbitly.example",
  files: {
    "INCIDENT.md": `# INC-015 · Every Message Arrives Twice

**Opened:** ${DATE} 13:00 UTC
**Severity:** SEV-3
**Service:** orbitly-help-web v2.0.0 (rebuilt contact page)

## Summary
Every contact-form message produces two tickets with identical text, a
few milliseconds apart. Customers get two confirmation emails.

## Evidence attached
- API logs and session-replay events from one submission (replay events are tagged [replay])
- The customer's browser capture

## Your task
Explain why one submission creates two tickets.
`,
    "package.json": `{
  "name": "orbitly-help-web",
  "version": "2.0.0",
  "private": true,
  "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" }
}
`,
    "src/contact/ContactForm.tsx": `import { useState, type FormEvent } from "react";
import { SubmitButton } from "../ui/SubmitButton";
import { sendContactMessage } from "./api";

export function ContactForm() {
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("billing");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const result = await sendContactMessage({ email, topic, message });
      setTicket(result.ticket);
    } finally {
      setSending(false);
    }
  }

  if (ticket) return <p role="status">Thanks! Your ticket number is {ticket}.</p>;

  return (
    <form onSubmit={submit}>
      <label>Email <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Topic
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          <option value="billing">Billing</option>
          <option value="technical">Technical</option>
        </select>
      </label>
      <label>Message <textarea required value={message} onChange={(e) => setMessage(e.target.value)} /></label>
      <SubmitButton busy={sending} onClick={() => submit()}>Send message</SubmitButton>
    </form>
  );
}
`,
    "src/ui/SubmitButton.tsx": `import type { ReactNode } from "react";

interface Props {
  busy?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

/** The primary button used across forms. Shows a spinner while busy. */
export function SubmitButton({ busy = false, onClick, children }: Props) {
  return (
    <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy} onClick={onClick}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
`,
    "src/contact/api.ts": `export async function sendContactMessage(input: { email: string; topic: string; message: string }) {
  const response = await fetch("/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(\`Could not send your message (\${response.status})\`);
  return response.json() as Promise<{ ticket: string }>;
}
`,
    "server/routes/contact.ts": `import { Router } from "express";
import { log } from "../log";
import { mailer } from "../mailer";
import { tickets } from "../tickets";

export const contact = Router();

contact.post("/api/contact", async (req, res) => {
  const { email, topic, message } = req.body as { email: string; topic: string; message: string };
  const ticket = await tickets.create({ email, topic, message });
  log.info("tickets", \`Ticket created id=\${ticket.id} topic=\${topic}\`);
  await mailer.sendConfirmation(email, ticket.id);
  res.status(201).json({ ticket: ticket.id });
});
`,
  },
  logs: [
    ["12:41:02.115", "INFO", "http", "GET /contact 200 3ms"],
    ["12:41:44.906", "INFO", "replay", "Click button=\"Send message\" (1 click)"],
    ["12:41:44.951", "INFO", "tickets", "Ticket created id=SUP-20417 topic=billing"],
    ["12:41:44.955", "INFO", "tickets", "Ticket created id=SUP-20418 topic=billing"],
    ["12:41:45.080", "INFO", "mail", "Confirmation sent ticket=SUP-20417"],
    ["12:41:45.081", "INFO", "http", "POST /api/contact 201 168ms"],
    ["12:41:45.086", "INFO", "mail", "Confirmation sent ticket=SUP-20418"],
    ["12:41:45.087", "INFO", "http", "POST /api/contact 201 170ms"],
    ["12:41:45.120", "INFO", "replay", "Rendered \"Thanks! Your ticket number is SUP-20418.\""],
  ],
  network: [
    { log: 1, type: "document", response: "<!doctype html><title>Contact us</title>" },
    { log: 6, initiator: "src/contact/api.ts", ms: 175, body: BODY, response: '{"ticket":"SUP-20417"}' },
    { log: 8, initiator: "src/contact/api.ts", ms: 178, body: BODY, response: '{"ticket":"SUP-20418"}' },
  ],
  options: [
    [
      "user-double-clicks",
      "Customers double-click the button",
      "A quick second click sends the form again before the button is disabled.",
    ],
    [
      "click-and-submit-both-send",
      "The button's click handler and the form's submit handler both send the message",
      "Clicking a submit button runs its onClick and then submits the form, and both paths call the same send function.",
    ],
    [
      "fetch-retry",
      "The request is retried automatically after a slow response",
      "A retry wrapper resends the message when the first response takes too long.",
    ],
    [
      "server-creates-twice",
      "The API creates two tickets for one request",
      "The contact endpoint stores the ticket twice for a single POST.",
    ],
  ],
});
