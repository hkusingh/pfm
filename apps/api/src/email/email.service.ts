import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = Number(process.env.SMTP_PORT ?? 587);

    // Provider-agnostic SMTP. Works with Mailtrap, SES, Postmark, etc.
    // If host/user/pass are not all set, emails are only logged (dev mode).
    this.transporter =
      host && user && pass
        ? nodemailer.createTransport({
            host,
            port,
            secure: port === 465, // implicit TLS on 465; STARTTLS on 587/2525
            auth: { user, pass },
          })
        : null;

    const appName = process.env.PUBLIC_APP_NAME ?? 'Smart Munshi';
    const fromAddress =
      process.env.EMAIL_FROM ?? `noreply@${process.env.EMAIL_DOMAIN ?? 'pfm.local'}`;
    this.from = `"${appName}" <${fromAddress}>`;

    if (!this.transporter) {
      this.logger.warn(
        'SMTP not configured (SMTP_HOST / SMTP_USER / SMTP_PASS) — emails will only be logged (dev mode)',
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
    if (!this.transporter) {
      this.logger.log(`[DEV EMAIL] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`SMTP error sending to ${opts.to}: ${message}`);
      throw new Error(`Failed to send email: ${message}`);
    }
  }
}
