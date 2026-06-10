import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const key = process.env.RESEND_API_KEY;
    this.resend = key ? new Resend(key) : null;
    this.from = `"${process.env.PUBLIC_APP_NAME ?? 'PFM'}" <noreply@${process.env.EMAIL_DOMAIN ?? 'pfm.local'}>`;

    if (!key) {
      this.logger.warn('RESEND_API_KEY not set — emails will only be logged (dev mode)');
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
    if (!this.resend) {
      this.logger.log(`[DEV EMAIL] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text}`);
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });

    if (error) {
      this.logger.error(`Resend error sending to ${opts.to}: ${JSON.stringify(error)}`);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }
}
