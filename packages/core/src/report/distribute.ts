import { EnterprisePolicy, type EgressPurpose } from "../enterprise/policy.js";

export type DeliveryChannel =
  | "local-directory"
  | "shared-directory"
  | "intranet-doc-service"
  | "notification";

export interface DeliveryTarget {
  readonly channel: DeliveryChannel;
  readonly location: string;
}

export interface DeliveryResult {
  readonly channel: DeliveryChannel;
  readonly location: string;
  readonly ok: boolean;
  readonly attempts: number;
  readonly error?: string;
}

export type DeliverySender = (target: DeliveryTarget, content: string) => Promise<void>;

function purposeOf(channel: DeliveryChannel): EgressPurpose {
  return channel === "notification" ? "notification" : "report-delivery";
}

export class ReportDistributor {
  constructor(
    private readonly policy: EnterprisePolicy,
    private readonly sender: DeliverySender,
    private readonly maxAttempts = 3,
  ) {}

  async deliver(target: DeliveryTarget, content: string): Promise<DeliveryResult> {
    this.policy.assertEgress(purposeOf(target.channel), target.location);

    let lastError = "";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        await this.sender(target, content);
        return { channel: target.channel, location: target.location, ok: true, attempts: attempt };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      channel: target.channel,
      location: target.location,
      ok: false,
      attempts: this.maxAttempts,
      error: lastError
    };
  }
}