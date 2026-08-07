import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequestOwnershipGuard } from '../common/guards/request-ownership.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../common/types/user-role.enum';
import type { UserDocument } from '../users/schemas/user.schema';
import { CreateRequestDto } from './dto/create-request.dto';
import { QueryRequestsDto } from './dto/query-requests.dto';
import { RespondDto } from './dto/respond.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { RequestsService } from './requests.service';

@ApiTags('Requests')
@ApiBearerAuth('access-token')
@UseGuards(RolesGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Roles(UserRole.CUSTOMER)
  @Post()
  @ApiOperation({
    summary: 'Submit a new claim or pre-authorization request',
    description:
      'Creates the request in SUBMITTED with no assigned officer, allocates its ' +
      'requestNumber, and writes the first REQUEST_CREATED audit entry.',
  })
  @ApiResponse({ status: 201, description: 'Request created.' })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_ERROR — e.g. a future incidentDate, or a missing serviceProvider on ' +
      'an HMO pre-authorization.',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — officers cannot submit requests.',
  })
  create(@CurrentUser() user: UserDocument, @Body() dto: CreateRequestDto) {
    return this.requestsService.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List requests',
    description:
      'A customer sees only their own requests; an officer sees all of them and may ' +
      'use the full filter set. Results are paginated.',
  })
  @ApiResponse({
    status: 200,
    description: 'A page of requests, with pagination meta.',
  })
  findAll(@CurrentUser() user: UserDocument, @Query() query: QueryRequestsDto) {
    return this.requestsService.findAll(user, query);
  }

  @UseGuards(RequestOwnershipGuard)
  @Get(':id')
  @ApiParam({ name: 'id', description: '24-character request id' })
  @ApiOperation({ summary: 'Fetch a single request' })
  @ApiResponse({ status: 200, description: 'The request.' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR — malformed id.' })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — a customer requesting someone else’s request.',
  })
  @ApiResponse({
    status: 404,
    description: 'NOT_FOUND — no request with that id.',
  })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.requestsService.findById(id);
  }

  @UseGuards(RequestOwnershipGuard)
  @Get(':id/audit-logs')
  @ApiParam({ name: 'id', description: '24-character request id' })
  @ApiOperation({
    summary: 'The request’s audit trail',
    description: 'Immutable, ascending by createdAt.',
  })
  @ApiResponse({ status: 200, description: 'The audit entries, oldest first.' })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — not the caller’s request.',
  })
  @ApiResponse({
    status: 404,
    description: 'NOT_FOUND — no request with that id.',
  })
  findAuditLogs(@Param('id', ParseObjectIdPipe) id: string) {
    return this.requestsService.findAuditLogs(id);
  }

  @Roles(UserRole.OFFICER)
  @UseGuards(RequestOwnershipGuard)
  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: '24-character request id' })
  @ApiOperation({
    summary: 'Claim an unassigned request',
    description:
      'Assigns the request to the calling officer and moves it SUBMITTED → ASSIGNED. ' +
      'There is no reassignment in this prototype.',
  })
  @ApiResponse({ status: 200, description: 'Assigned to the calling officer.' })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — customers cannot assign.',
  })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_TRANSITION — already assigned, or not in SUBMITTED. Also returned if ' +
      'another officer claimed it a moment earlier.',
  })
  assign(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: UserDocument,
  ) {
    return this.requestsService.assign(id, user);
  }

  @Roles(UserRole.OFFICER)
  @UseGuards(RequestOwnershipGuard)
  @Patch(':id/status')
  @ApiParam({ name: 'id', description: '24-character request id' })
  @ApiOperation({
    summary: 'Move a request through the workflow',
    description:
      'Assignee only. Legality comes from the SPEC §3 transition table. The two ' +
      'customer-driven moves out of NEEDS_ADDITIONAL_INFO are not available here — ' +
      'those belong to POST /respond and POST /withdraw.',
  })
  @ApiResponse({ status: 200, description: 'Status changed.' })
  @ApiResponse({
    status: 400,
    description:
      'COMMENT_REQUIRED — moving to NEEDS_ADDITIONAL_INFO or DENIED needs one.',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN — not the assignee, or attempting a customer-driven transition.',
  })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_TRANSITION — the move is not allowed from the current status.',
  })
  updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: UserDocument,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.requestsService.updateStatus(id, user, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @UseGuards(RequestOwnershipGuard)
  @Post(':id/respond')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: '24-character request id' })
  @ApiOperation({
    summary: 'Answer a request for more information',
    description:
      'Owner only, and only while the request is NEEDS_ADDITIONAL_INFO. Moves it back ' +
      'to UNDER_REVIEW automatically — the customer never names a status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Response recorded; back under review.',
  })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — not the owner.' })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_TRANSITION — the request is not awaiting information.',
  })
  respond(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: UserDocument,
    @Body() dto: RespondDto,
  ) {
    return this.requestsService.respond(id, user, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @UseGuards(RequestOwnershipGuard)
  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: '24-character request id' })
  @ApiOperation({
    summary: 'Withdraw a request',
    description:
      'Owner only, and only while the request is NEEDS_ADDITIONAL_INFO (SPEC §11.8). ' +
      'WITHDRAWN is terminal.',
  })
  @ApiResponse({ status: 200, description: 'Request withdrawn.' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — not the owner.' })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_TRANSITION — the request is not awaiting information.',
  })
  withdraw(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: UserDocument,
  ) {
    return this.requestsService.withdraw(id, user);
  }
}
