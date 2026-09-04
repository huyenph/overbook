import { Injectable, Logger } from '@nestjs/common';

/**
 * M8 / Q53 — the state machine behind a zero-dropped-request deploy.
 *
 * The sequence that matters on SIGTERM is:
 *
 *   1. flip to draining -> /health/ready starts failing
 *   2. the load balancer notices and stops sending new requests
 *   3. only then stop accepting and finish what is already in flight
 *
 * Skipping step 1 is the classic bug: the process exits correctly but the
 * balancer is still routing to it, so users see connection resets during every
 * deploy and every scale-down.
 */
@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);
  private draining = false;
  private readonly startedAt = new Date();

  get isDraining(): boolean {
    return this.draining;
  }

  get uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
  }

  beginDraining(): void {
    if (this.draining) return;
    this.draining = true;
    this.logger.warn('draining: readiness is now failing, waiting for the balancer to notice');
  }
}
