/**
 * User Service Integration
 * Handles token verification with the user service
 */

import fetch from 'node-fetch';

const USER_SERVICE_BASE_URL = process.env.USER_SERVICE_URL || 'https://jong-tappable-darrin.ngrok-free.dev';

/**
 * Generate random username and email when they're empty
 * @param {Object} userData - User data from token verification
 * @returns {Object} - User data with generated username and email
 */
const generateUserDetails = (userData) => {
    const randomInt = Math.floor(Math.random() * 1000) + 1;
    
    return {
        ...userData,
        username: userData.username || `kia_${randomInt}`,
        email: userData.email || `test${randomInt}@gmail.com`,
        name: userData.name || `User ${randomInt}`,
        phone: userData.phone || `+2547${randomInt.toString().padStart(8, '0')}`
    };
};

/**
 * Verify token with user service
 * @param {string} token - The authorization token
 * @returns {Promise<Object>} - User details or error
 */
export const verifyToken = async (token) => {
    try {
        console.log(`Verifying token with user service: ${USER_SERVICE_BASE_URL}/api/users/validate-token/`);
        
        const response = await fetch(`${USER_SERVICE_BASE_URL}/api/users/validate-token/`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true' // Skip ngrok browser warning
            }
        });

        let result;
        try {
            result = await response.json();
        } catch (jsonError) {
            console.error('JSON parsing error:', jsonError);
            // If JSON parsing fails (e.g., HTML response), this is a validation failure
            console.log('Invalid JSON response from user service - token validation failed');
            
            return {
                success: false,
                error: {
                    code: 'TOKEN_VALIDATION_FAILED',
                    message: 'Token validation failed',
                    details: 'Invalid response from user service',
                    status: response.status
                }
            };
        }

        if (!response.ok) {
            console.error('Token verification failed:', {
                status: response.status,
                error: result
            });
            
            // Token validation failed - return error, don't proceed
            return {
                success: false,
                error: {
                    code: 'TOKEN_VALIDATION_FAILED',
                    message: 'Token validation failed',
                    details: result,
                    status: response.status
                }
            };
        }

        // Token validation passed - check if user details are complete
        const userDetails = generateUserDetails(result);
        
        console.log('Token verification successful:', {
            userId: userDetails.id,
            username: userDetails.username,
            email: userDetails.email
        });

        return {
            success: true,
            user: {
                id: userDetails.id.toString(), // Convert to string for consistency
                username: userDetails.username,
                email: userDetails.email,
                name: userDetails.name,
                phone: userDetails.phone
            },
            data: userDetails
        };

    } catch (error) {
        console.error('Token verification error:', error);
        
        // Network errors or service unavailable - this is a validation failure
        return {
            success: false,
            error: {
                code: 'TOKEN_VALIDATION_FAILED',
                message: 'Token validation service unavailable',
                details: error.message
            }
        };
    }
};

/**
 * Extract user ID from verified token response
 * @param {Object} verificationResult - Result from verifyToken
 * @returns {string|null} - User ID or null
 */
export const extractUserId = (verificationResult) => {
    if (!verificationResult) {
        return null;
    }
    
    // Check both possible locations for user ID
    return verificationResult.user?.id || verificationResult.id || null;
};

/**
 * Extract user details from verified token response
 * @param {Object} verificationResult - Result from verifyToken
 * @returns {Object|null} - User details or null
 */
export const extractUserDetails = (verificationResult) => {
    if (!verificationResult) {
        return null;
    }
    
    // Return user details from the user object if available, otherwise return the whole result
    return verificationResult.user || verificationResult;
};
