/**
 * @swagger
 * /api/removeFriend:
 *   delete:
 *     description: Remove a friend
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
 *       - name: friend
 *         description: Friend's username
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       '204':
 *         description: Friend removed
 *       '400':
 *        description: Bad request
 * 
 */