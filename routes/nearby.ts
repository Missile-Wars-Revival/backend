/**
 * @swagger
 * /api/nearby:
 *   get:
 *     description: Get nearby users
 *     parameters:
 *       - name: username
 *         description: User's username
 *         in: query
 *         required: true
 *         type: string
 *       - name: latitude
 *         description: Latitude coordinate
 *         in: query
 *         required: true
 *         type: string
 *       - name: longitude
 *         description: Longitude coordinate
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       '200':
 *         description: Nearby users found
 *       '404':
 *         description: No nearby users found
 */