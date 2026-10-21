import { simpleParser } from 'mailparser'
import { SMTPServer } from 'smtp-server'
import { SMTP_SINK } from './smtp-sink.config'

export default async function setup(): Promise<() => Promise<void>> {
  const server = new SMTPServer({
    authOptional: false,
    authMethods: ['PLAIN', 'LOGIN'],
    disabledCommands: ['STARTTLS'],
    allowInsecureAuth: true,
    onAuth(auth, _session, callback) {
      if (auth.username === SMTP_SINK.username && auth.password === SMTP_SINK.password) callback(null, { user: SMTP_SINK.username })
      else callback(new Error('Invalid SMTP credentials'))
    },
    async onData(stream, session, callback) {
      try {
        const message = await simpleParser(stream)
        const recipient = session.envelope.rcptTo.map((entry) => entry.address.toLowerCase())
        const expected = recipient.map((address) => SMTP_SINK.expectations[address])
        if (expected.length === 0 || expected.some((subject) => !subject)) throw new Error(`unexpected SMTP recipient: ${recipient.join(', ')}`)
        const subject = message.subject ?? ''
        if (!expected.every((keyword) => keyword && subject.includes(keyword))) throw new Error(`unexpected SMTP subject: ${subject}`)
        if (session.envelope.mailFrom === false || session.envelope.mailFrom.address !== SMTP_SINK.from) throw new Error(`unexpected SMTP sender: ${String(session.envelope.mailFrom)}`)
        if (!message.text || message.text.trim().length === 0) throw new Error('SMTP message has no text body')
        callback()
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    },
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(SMTP_SINK.port, SMTP_SINK.host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return () => new Promise<void>((resolve) => server.close(() => resolve()))
}
