import { Controller, Get } from '@nestjs/common';
import { AdAccountsService } from './ad-accounts.service';

@Controller('api/ad-accounts')
export class AdAccountsController {
  constructor(private adAccountsService: AdAccountsService) {}

  @Get()
  async getAdAccounts() {
    return this.adAccountsService.getAdAccounts();
  }
}
