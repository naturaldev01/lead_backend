import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getStats(
    startDate: string,
    endDate: string,
    accountId?: string,
    objective?: string,
  ) {
    const supabase = this.supabaseService.getClient();

    let campaignQuery = supabase
      .from('campaigns')
      .select('spend_usd')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    let leadsQuery = supabase
      .from('leads')
      .select('id', { count: 'exact' })
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (accountId) {
      campaignQuery = campaignQuery.eq('ad_account_id', accountId);
      leadsQuery = leadsQuery.eq('ad_account_id', accountId);
    }

    if (objective) {
      campaignQuery = campaignQuery.eq('type', objective);
    }

    const [campaignResult, leadsResult, syncResult] = await Promise.all([
      campaignQuery,
      leadsQuery,
      supabase
        .from('sync_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2),
    ]);

    const totalSpend = (campaignResult.data || []).reduce(
      (sum, c) => sum + (c.spend_usd || 0),
      0,
    );

    const syncLogs = syncResult.data || [];
    const spendSync = syncLogs.find((s) => s.type === 'spend');
    const leadsSync = syncLogs.find((s) => s.type === 'leads');

    return {
      totalSpend,
      totalLeads: leadsResult.count || 0,
      lastSpendSync: spendSync?.created_at || null,
      lastLeadsSync: leadsSync?.created_at || null,
    };
  }
}
