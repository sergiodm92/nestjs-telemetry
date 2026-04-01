import { Controller, Get, Post, Delete, Query, Param, Res, Injectable, Inject } from '@nestjs/common';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { TelemetryStorage } from '../storage/telemetry-storage.interface';
import { TelemetryEntryType } from '../model/telemetry-entry-type';
import { TELEMETRY_STORAGE } from '../telemetry.constants';

interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T;
}

function success<T>(message: string, data: T): ApiResponse<T> {
  return { success: true, message, data };
}

function error(message: string): ApiResponse {
  return { success: false, message, data: null };
}

@Injectable()
@Controller()
export class TelemetryController {
  constructor(@Inject(TELEMETRY_STORAGE) private readonly storage: TelemetryStorage) {}

  @Get()
  serveDashboard(@Res() res: Response): void {
    const htmlPath = path.join(__dirname, '..', 'dashboard', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    res.type('text/html').send(html);
  }

  @Get('entries')
  async getEntries(
    @Query('type') type: string,
    @Query('page') page: number = 0,
    @Query('size') size: number = 50,
    @Query('userIdentifier') userIdentifier?: string,
    @Query('tenantId') tenantId?: string,
    @Query('method') method?: string,
    @Query('statusGroup') statusGroup?: string,
    @Query('search') search?: string,
  ): Promise<ApiResponse> {
    if (!type) return error('type parameter is required');

    const entryType = type as TelemetryEntryType;
    const filters = { userIdentifier, tenantId, method, statusGroup, search };
    const entries = await this.storage.getByType(
      entryType,
      filters,
      Number(page) || 0,
      Number(size) || 50,
    );
    return success('ok', entries);
  }

  @Get('entries/:uuid')
  async getEntry(@Param('uuid') uuid: string): Promise<ApiResponse> {
    const entry = await this.storage.getByUuid(uuid);
    if (!entry) return error('Entry not found');
    return success('ok', entry);
  }

  @Get('entries/:uuid/related')
  async getRelatedEntries(@Param('uuid') uuid: string): Promise<ApiResponse> {
    const entry = await this.storage.getByUuid(uuid);
    if (!entry || !entry.batchId) return success('ok', []);
    const related = await this.storage.getByBatchId(entry.batchId);
    return success('ok', related);
  }

  @Get('filters')
  async getFilters(): Promise<ApiResponse> {
    const users = await this.storage.getDistinctUserIdentifiers();
    const tenants = await this.storage.getDistinctTenantIds();
    return success('ok', {
      users: users.map((id) => ({ id, name: id })),
      tenants: tenants.map((id) => ({ id, name: id })),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      statuses: ['2xx', '3xx', '4xx', '5xx'],
    });
  }

  @Get('stats')
  async getStats(): Promise<ApiResponse> {
    const stats = await this.storage.getStats();
    return success('ok', stats);
  }

  @Get('status')
  async getStatus(): Promise<ApiResponse> {
    const stats = await this.storage.getStats();
    const memory = await this.storage.getMemoryInfo();
    return success('ok', {
      enabled: this.storage.isEnabled(),
      stats,
      memory,
    });
  }

  @Get('tags')
  async getTags(): Promise<ApiResponse> {
    const tags = await this.storage.getDistinctTags();
    return success('ok', tags);
  }

  @Get('memory')
  async getMemory(): Promise<ApiResponse> {
    const info = await this.storage.getMemoryInfo();
    return success('ok', info);
  }

  @Post('toggle')
  async toggle(): Promise<ApiResponse> {
    const newState = !this.storage.isEnabled();
    this.storage.setEnabled(newState);
    return success('ok', { enabled: newState });
  }

  @Post('flush')
  async flush(): Promise<ApiResponse> {
    await this.storage.flush();
    const info = await this.storage.getMemoryInfo();
    return success('Buffer flushed', info);
  }

  @Post('prune')
  async prune(@Query('hours') hours: number = 24): Promise<ApiResponse> {
    const h = Number(hours) || 24;
    const cutoff = new Date(Date.now() - h * 60 * 60 * 1000);
    const pruned = await this.storage.pruneOlderThan(cutoff);
    return success('ok', { pruned, hours: h });
  }

  @Post('prune/expired')
  async pruneExpired(@Query('hours') hours: number = 24): Promise<ApiResponse> {
    const h = Number(hours) || 24;
    const cutoff = new Date(Date.now() - h * 60 * 60 * 1000);
    const pruned = await this.storage.pruneOlderThan(cutoff);
    return success('ok', { pruned, retentionHours: h });
  }

  @Delete('entries')
  async clearEntries(@Query('type') type?: string): Promise<ApiResponse> {
    if (type) {
      await this.storage.clearByType(type as TelemetryEntryType);
    } else {
      await this.storage.clear();
    }
    return success('Entries cleared', null);
  }
}
