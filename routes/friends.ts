/**
 * @swagger
 * /api/getFriends:
 *   get:
 *     description: Get user's friends
 *     parameters:
 *       - name: username
 *         description: User's username
 *         in: query
 *         required: true
 *         type: string
 *       - name: password
 *         description: User's password
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       '200':
 *         description: List of user's friends
 *       '400':
 *        description: Bad request
 * 
 */