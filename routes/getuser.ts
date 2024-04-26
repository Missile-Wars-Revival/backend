/**
 * @swagger
 * /api/getuser:
 *   get:
 *     description: Get user by username
 *     parameters:
 *       - name: username
 *         description: User's username
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       '200':
 *         description: User found
 *       '400':
 *        description: Bad request
 * 
 */