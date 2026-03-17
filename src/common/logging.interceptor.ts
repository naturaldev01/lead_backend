import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const elapsedMs = Date.now() - startTime;
        const threshold = 500;
        
        if (url.includes('/api/dashboard') || elapsedMs > threshold) {
          const level = elapsedMs > 1000 ? 'warn' : 'log';
          this.logger[level](
            `${method} ${url} - ${elapsedMs}ms${elapsedMs > threshold ? ' [SLOW]' : ''}`,
          );
        }
      }),
    );
  }
}
