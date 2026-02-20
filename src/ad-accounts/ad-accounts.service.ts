import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

@Injectable()
export class AdAccountsService {
  private readonly logger = new Logger(AdAccountsService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getAdAccounts() {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('ad_accounts')
      .select('*')
      .order('account_name', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch ad accounts', error);
      throw error;
    }

    return (data || []).map((account) => ({
      id: account.id,
      accountId: account.account_id,
      accountName: account.account_name,
    }));
  }
}
