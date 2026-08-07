import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/types/user-role.enum';
import type { UserDocument } from '../users/schemas/user.schema';
import { DashboardService } from './dashboard.service';
import { DashboardStatsDto } from './dto/dashboard-stats.dto';

@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Roles(UserRole.OFFICER)
  @Get('stats')
  @ApiOperation({
    summary: 'Queue metrics for the officer dashboard',
    description:
      'Counts across the whole request collection, except assignedToMe which is scoped ' +
      'to the calling officer. Computed in a single aggregation pass.',
  })
  @ApiResponse({ status: 200, type: DashboardStatsDto })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — customers have no dashboard.',
  })
  getStats(@CurrentUser() user: UserDocument): Promise<DashboardStatsDto> {
    return this.dashboardService.getStats(user._id);
  }
}
