import { IsString, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MappingRuleDto {
  @IsString()
  sourceField: string;

  @IsString()
  sourceValue: string;

  @IsString()
  targetEntity: string;

  @IsString()
  targetId: string;
}

export class CreateMappingDto {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingRuleDto)
  rules: MappingRuleDto[];
}

export class UpdateMappingDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingRuleDto)
  rules?: MappingRuleDto[];
}
