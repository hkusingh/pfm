import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiUrl: string | null;
  private readonly apiToken: string | null;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor() {
    // Mailtrap HTTP Email API (port 443). We use HTTP rather than SMTP because
    // Railway (and most PaaS) block outbound SMTP ports — an HTTPS API is the
    // reliable transport. Switching providers means changing send() to match
    // their API, but it's isolated to this one method.
    //   Sandbox:  https://sandbox.api.mailtrap.io/api/send/<INBOX_ID>
    //   Live:     https://send.api.mailtrap.io/api/send
    this.apiUrl = process.env.MAILTRAP_API_URL ?? null;
    this.apiToken = process.env.MAILTRAP_API_TOKEN ?? null;
    this.fromName = process.env.PUBLIC_APP_NAME ?? 'Smart Munshi';
    this.fromAddress = process.env.EMAIL_FROM ?? 'noreply@thesmartmunshi.com';

    if (!this.apiUrl || !this.apiToken) {
      this.logger.warn(
        'Email API not configured (MAILTRAP_API_URL / MAILTRAP_API_TOKEN) — emails will only be logged (dev mode)',
      );
    }
  }

  async sendEmailVerification(to: string, verificationUrl: string): Promise<void> {
    await this.send({
      to,
      subject: 'Verify your email address',
      text: `Click the link to verify your email:\n\n${verificationUrl}\n\nThis link expires in 24 hours.`,
      html: `<p>Click the link below to verify your email address:</p>
             <p><a href="${verificationUrl}">${verificationUrl}</a></p>
             <p>This link expires in 24 hours.</p>`,
    });
  }

  async sendSignupInvite(to: string, signupUrl: string): Promise<void> {
    await this.send({
      to,
      subject: "You're invited to join",
      text: `You've been invited to create an account. Click the link to get started:\n\n${signupUrl}\n\nThis invite expires in 7 days.`,
      html: `<p>You've been invited to create an account.</p>
             <p><a href="${signupUrl}">Accept invitation</a></p>
             <p>This invite expires in 7 days.</p>`,
    });
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    await this.send({
      to,
      subject: 'Reset your password',
      text: `Click the link to reset your password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
      html: `<p>Click the link below to reset your password:</p>
             <p><a href="${resetUrl}">${resetUrl}</a></p>
             <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
    });
  }

  async sendHouseholdInvite(
    to: string,
    inviterName: string,
    householdName: string,
    role: string,
    acceptUrl: string,
  ): Promise<void> {
    const roleLabel = role === 'owner' ? 'co-owner' : 'member';
    await this.send({
      to,
      subject: `${inviterName} invited you to join ${householdName}`,
      text: `${inviterName} has invited you to join "${householdName}" as a ${roleLabel}.\n\nAccept the invitation:\n${acceptUrl}\n\nThis invite expires in 7 days.`,
      html: `<p>${inviterName} has invited you to join <strong>${householdName}</strong> as a ${roleLabel}.</p>
             <p><a href="${acceptUrl}">Accept invitation</a></p>
             <p>This invite expires in 7 days.</p>`,
    });
  }

  async sendMfaCode(to: string, code: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your login verification code',
      text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
      html: `<p>Your verification code is:</p>
             <p style="font-size:2rem;font-weight:bold;letter-spacing:0.2em">${code}</p>
             <p>This code expires in 10 minutes. Do not share it with anyone.</p>`,
    });
  }

  private async send(opts: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    if (!this.apiUrl || !this.apiToken) {
      this.logger.log(`[DEV EMAIL] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text}`);
      return;
    }

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { email: this.fromAddress, name: this.fromName },
          to: [{ email: opts.to }],
          subject: opts.subject,
          text: opts.text,
          html: opts.html,
        }),
        // Fail fast instead of hanging the request on a slow/blocked connection.
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${detail}`.trim());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Email API error sending to ${opts.to}: ${message}`);
      throw new Error(`Failed to send email: ${message}`);
    }
  }
}
