import { ApiProperty } from '@nestjs/swagger';

export class RagMetadataDto {
  @ApiProperty({
    description: 'Files selected for this query',
    example: ['rukh-definition.md', 'architecture.md'],
  })
  selectedFiles: string[];

  @ApiProperty({
    description: 'Total files available in the context',
    example: 10,
  })
  totalFilesAvailable: number;

  @ApiProperty({
    description: 'Selection method used',
    example: 'rag-two-step',
  })
  selectionMethod: string;

  @ApiProperty({
    description: 'Cost of the file selection phase',
    type: () => require('./ask-response.dto').CostDto,
    required: false,
  })
  selectionCost?: any;
}
