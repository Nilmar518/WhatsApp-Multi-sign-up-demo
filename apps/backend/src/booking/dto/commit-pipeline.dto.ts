import { IsNotEmpty, IsString } from 'class-validator';

export class CommitPipelineDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}
