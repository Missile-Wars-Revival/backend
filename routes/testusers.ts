
/**
 * @swagger
 * /api/testusers:
 *   get:
 *     description: Returns all test users
 *     responses:
 *       200:
 *         description: An array of test users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 object:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                     password:
 *                       type: string
 *                     email:
 *                       type: string
 *                     id:
 *                       type: string
 *                     role:
 *                       type: string
 *                     avatar:
 *                       type: string
 * 
 * 
 */