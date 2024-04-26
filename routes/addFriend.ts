/**
 * @swagger
 * /api/addFriend:
 *   post:
 *     description: Add a friend
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
 *       '200':
 *         description: Friend added
 *       '400':
 *        description: Bad request
 * 
 */