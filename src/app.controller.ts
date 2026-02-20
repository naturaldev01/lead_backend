import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return { message: 'Marketing Leads API' };
  }

  @Get('api/health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
