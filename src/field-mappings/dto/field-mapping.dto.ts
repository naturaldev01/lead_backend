import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateFieldMappingDto {
  @IsString()
  rawFieldName: string;

  @IsString()
  mappedField: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsBoolean()
  @IsOptional()
  autoDetected?: boolean;
}

export class UpdateFieldMappingDto {
  @IsString()
  @IsOptional()
  rawFieldName?: string;

  @IsString()
  @IsOptional()
  mappedField?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsBoolean()
  @IsOptional()
  autoDetected?: boolean;
}

export interface FieldMapping {
  id: string;
  raw_field_name: string;
  mapped_field: string;
  language: string | null;
  auto_detected: boolean;
  created_at: string;
}

export interface UnmappedField {
  fieldName: string;
  count: number;
  sampleValues: string[];
}
