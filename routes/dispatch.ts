/**
 * @swagger
 * /api/dispatch:
 *   post:
 *     description: Update user's location
 *     parameters:
 *       - name: username
 *         description: User's username
 *         in: formData
 *         required: true
 *         type: string
 *       - name: latitude
 *         description: Latitude coordinate
 *         in: formData
 *         required: true
 *         type: string
 *       - name: longitude
 *         description: Longitude coordinate
 *         in: formData
 *         required: true
 *         type: string
 *     responses:
 *       '200':
 *         description: Location updated successfully
 *       '400':
 *         description: Bad request
 */