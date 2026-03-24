import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { CacheService } from './cache.service';

@Global()
@Module({
  providers: [SupabaseService, CacheService],
  exports: [SupabaseService, CacheService],
})
export class CommonModule {}
