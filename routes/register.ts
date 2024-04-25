/**
 * @swagger
 * /api/register:
 *   post:
 *     description: Register a new user
 *     parameters:
 *       - name: username
 *         description: User's username
 *         in: formData
 *         required: true
 *         type: string
 *       - name: email
 *         description: User's email
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
 *         description: User created successfully
 *       '400':
 *         description: Bad request
 *       '409':
 *         description: User already exists
 */