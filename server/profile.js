import { Router } from 'express';
import { pool, transaction } from './db.js';
import { requireAuth } from './security.js';
import { parse, profileSchema } from './validation.js';
import { userColumns, privateUser } from './auth.js';
import { upload, uploadLimit, prepareImage, removeFiles } from './uploads.js';

export function profileRouter() {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => res.json({ user: privateUser((await pool.query(`SELECT ${userColumns} FROM users WHERE id=$1`, [req.session.userId])).rows[0]) }));
  router.patch('/', async (req, res) => {
    const data = parse(profileSchema, req.body);
    const row = (await pool.query(`UPDATE users SET name=$1,phone=$2,bio=$3 WHERE id=$4 RETURNING ${userColumns}`, [data.name, data.phone, data.bio, req.session.userId])).rows[0];
    res.json({ user: privateUser(row) });
  });
  router.post('/avatar', uploadLimit(), upload.single('avatar'), async (req, res) => {
    const filename = await prepareImage(req.file, true);
    let result;
    try {
      result = await transaction(async client => {
        const previous = (await client.query('SELECT avatar_filename FROM users WHERE id=$1 FOR UPDATE', [req.session.userId])).rows[0];
        const user = (await client.query(`UPDATE users SET avatar_filename=$1 WHERE id=$2 RETURNING ${userColumns}`, [filename, req.session.userId])).rows[0];
        return { user, previous: previous.avatar_filename };
      });
    } catch (err) { await removeFiles([filename]); throw err; }
    if (result.previous) await removeFiles([result.previous]);
    res.json({ user: privateUser(result.user) });
  });
  return router;
}
