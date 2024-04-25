/**
 * @swagger
 * /api/login:
 *   post:
 *     description: Login user
 *     parameters:
 *       - name: username
 *         description: User's username
 *         in: formData
 *         required: true
 *         type: string
 *       - name: password
 *         description: User's password
 *         in: formData
 *         required: true
 *         type: string
 *     responses:
 *       '200':
 *         description: Successful login
 *       '401':
 *         description: Unauthorized
 */