import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ReplyToCommentDto {
  /**
   * PUBLIC  — POST /v25.0/{commentId}/replies (visible under the post)
   * PRIVATE — POST /v25.0/{PAGE_ID}/messages with recipient.comment_id
   *           Subject to Single Reply Rule + 7-day temporal limit.
   */
  @IsIn(['PUBLIC', 'PRIVATE'])
  type: 'PUBLIC' | 'PRIVATE';

  /** The Meta comment ID received in the webhook payload */
  @IsString()
  @IsNotEmpty()
  commentId: string;

  /** Instagram-Scoped ID of the commenter — used to locate the Firestore record */
  @IsString()
  @IsNotEmpty()
  igsid: string;

  @IsString()
  @IsNotEmpty()
  text: string;
}
