import { Controller, Get, Post } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

@Controller('api/subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Get()
  async getSubscriptions() {
    return this.subscriptionsService.getSubscriptions();
  }

  @Post('refresh')
  async refreshSubscriptions() {
    return this.subscriptionsService.refreshSubscriptions();
  }

  @Post('auto-subscribe')
  async autoSubscribe() {
    return this.subscriptionsService.autoSubscribe();
  }
}
