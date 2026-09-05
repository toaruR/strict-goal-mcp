import { writeSession } from './session_store.js';
import { exportDashboard } from '../dashboard/export.js';

// 状態変更ツール（loop_open/artifact_commit/score_submit/escalate/rubric_amend/kickback/supersede）の
// 共通の書き込み口。session.json の保存に加え、人間向け HTML ダッシュボードを毎回再生成する。
export function persistSession(dataDir, session) {
  writeSession(dataDir, session);
  exportDashboard(dataDir, session.session_id);
}
