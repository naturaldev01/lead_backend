import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private supabaseService: SupabaseService) {}

  async getStats(
    startDate?: string,
    endDate?: string,
    accountId?: string,
    objective?: string,
  ) {
    const supabase = this.supabaseService.getClient();

    let totalSpend = 0;
    let totalLeads = 0;

    // If date range is provided, use daily_insights table with SQL aggregation
    if (startDate && endDate) {
      const { data, error } = await supabase.rpc('get_daily_insights_totals', {
        start_date: startDate,
        end_date: endDate,
        account_id: accountId || null,
      });

      if (!error && data) {
        totalSpend = parseFloat(data.total_spend) || 0;
        totalLeads = parseInt(data.total_leads) || 0;
      }
    } else {
      // All time - use campaigns table with SQL aggregation
      const { data, error } = await supabase.rpc('get_campaigns_totals', {
        account_id: accountId || null,
        campaign_objective: objective || null,
      });

      if (!error && data) {
        totalSpend = parseFloat(data.total_spend) || 0;
        totalLeads = parseInt(data.total_leads) || 0;
      }
    }

    // Get sync logs
    const { data: syncLogs } = await supabase
      .from('sync_logs')
      .select('type, created_at')
      .order('created_at', { ascending: false })
      .limit(2);

    const spendSync = (syncLogs || []).find((s) => s.type === 'spend');
    const leadsSync = (syncLogs || []).find((s) => s.type === 'leads' || s.type === 'spend');

    return {
      totalSpend,
      totalLeads,
      lastSpendSync: spendSync?.created_at || null,
      lastLeadsSync: leadsSync?.created_at || null,
    };
  }
}
