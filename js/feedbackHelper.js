
const transformLandmarks = (originalLandmarks, newLandmarks) => {
    // Assume originalLandmarks and newLandmarks are arrays of landmarks
    // and originalLandmarks[0] and newLandmarks[0] are the wrists
    originalLandmarks = flipLandmarks(originalLandmarks);

    // Scale
    let axis0 = 0;
    let axis1 = 5;
    let scale = Math.sqrt(Math.pow(newLandmarks[axis0].x - newLandmarks[axis1].x, 2) + Math.pow(newLandmarks[axis0].y - newLandmarks[axis1].y, 2)) /
    Math.sqrt(Math.pow(originalLandmarks[axis0].x - originalLandmarks[axis1].x, 2) + Math.pow(originalLandmarks[axis0].y - originalLandmarks[axis1].y, 2));
    axis0 = 5;
    axis1 = 17;
    let scale2 = Math.sqrt(Math.pow(newLandmarks[axis0].x - newLandmarks[axis1].x, 2) + Math.pow(newLandmarks[axis0].y - newLandmarks[axis1].y, 2)) /
        Math.sqrt(Math.pow(originalLandmarks[axis0].x - originalLandmarks[axis1].x, 2) + Math.pow(originalLandmarks[axis0].y - originalLandmarks[axis1].y, 2));
    if (scale2 > scale) {
    scale = scale2;
    }

    // Apply scaling
    let scaledLandmarks = originalLandmarks.map(landmark => {
    let dx = landmark.x - originalLandmarks[0].x;
    let dy = landmark.y - originalLandmarks[0].y;
    return {
        x: originalLandmarks[0].x + dx * scale,
        y: originalLandmarks[0].y + dy * scale,
        visibility: landmark.visibility
    };
    });

    // Compute rotation angle for each joint and apply rotation
    let rotatedLandmarks = scaledLandmarks.map((landmark, index) => {
    let dx = landmark.x - scaledLandmarks[0].x;
    let dy = landmark.y - scaledLandmarks[0].y;
    let distance = Math.sqrt(dx*dx + dy*dy);

    // Compute rotation angle for this joint
    let angleOriginal = Math.atan2(originalLandmarks[index].y - originalLandmarks[0].y, originalLandmarks[index].x - originalLandmarks[0].x);
    let angleNew = Math.atan2(newLandmarks[index].y - newLandmarks[0].y, newLandmarks[index].x - newLandmarks[0].x);
    let dAngle = angleNew - angleOriginal;

    // If dAngle is within the maximum rotation angle, use it, otherwise use the maximum rotation angle
    let maxTheta = Math.PI * 0.025;
    let rotationAngle = Math.abs(dAngle) <= maxTheta ? dAngle : Math.sign(dAngle) * maxTheta;

    // Apply rotation to this joint
    return {
        x: scaledLandmarks[0].x + distance * Math.cos(angleOriginal + rotationAngle),
        y: scaledLandmarks[0].y + distance * Math.sin(angleOriginal + rotationAngle),
        visibility: landmark.visibility
    };
    });


    // Create an array to hold the adjusted landmarks
    let adjustedLandmarks = [];

    // Process each landmark in order
    for (let index = 0; index < rotatedLandmarks.length; index++) {
    let landmark = rotatedLandmarks[index];

    if (index === 0 || index === 1 || index === 5 || index === 9 || index === 13 || index === 17) {
        // No need to adjust for the wrist or the bases of the fingers
        adjustedLandmarks.push(landmark);
    } else {
        // Only adjust for the tips of the fingers
        // if ([3,4,7,8,11,12,15,16,19,20].includes(index)) {
        // Calculate the original distance from the current joint to the tip
        let rotatedDistance = Math.sqrt(Math.pow(landmark.x - rotatedLandmarks[index - 1].x, 2) + Math.pow(landmark.y - rotatedLandmarks[index - 1].y, 2));

        // Calculate the direction from the joint to the tip
        let dx = landmark.x - rotatedLandmarks[index - 1].x;
        let dy = landmark.y - rotatedLandmarks[index - 1].y;

        // Normalize the direction
        let length = Math.sqrt(dx * dx + dy * dy);
        dx /= length;
        dy /= length;

        // Scale the direction by the original distance
        let desiredDistance = Math.min(rotatedDistance, 3.1 * length);
        dx *= desiredDistance;
        dy *= desiredDistance;

        // Add the scaled direction to the joint's position to get the new position for the tip
        adjustedLandmarks.push({
            x: rotatedLandmarks[index - 1].x + dx,
            y: rotatedLandmarks[index - 1].y + dy,
            visibility: landmark.visibility
        });
        // } else {
        // adjustedLandmarks.push(landmark);
        // }
    }
    }
    // Apply translation
    let transformedLandmarks = adjustedLandmarks.map(landmark => {
    return {
        x: landmark.x + newLandmarks[0].x - adjustedLandmarks[0].x,
        y: landmark.y + newLandmarks[0].y - adjustedLandmarks[0].y,
        visibility: landmark.visibility
    };
    });


    return transformedLandmarks;
}

function flipLandmarks(landmarks) {
    // Flip the x-coordinates of the landmarks
    return landmarks.map(landmark => {
    return {
        x: 1 - landmark.x,
        y: landmark.y,
        visibility: landmark.visibility
    };
    });
}

function scoreLandmarks(landmarks1, landmarks2) {
    const numLandmarks = landmarks1.length;

    let score = 0;

    for (let i = 0; i < numLandmarks; i++) {
    // distance between corresponding landmarks
    const dx = landmarks1[i].x - landmarks2[i].x;
    const dy = landmarks1[i].y - landmarks2[i].y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Calculate the weight for this landmark, decreasing outwords from the wrist (0):
    // 0 - 1 - 2 - 3 - 4
    // 0 - 5 - 6 - 7 - 8
    // 0 - 9 - 10 - 11 - 12
    // 0 - 13 - 14 - 15 - 16
    // 0 - 17 - 18 - 19 - 20
    let relativeIndex = (i === 0) ? 0 : 4 - ((i - 1) % 4);
    // Penalize thumb landmarks more
    if (i === 3 || i === 4) {
        relativeIndex -= 0.5;
    }
    const weight = 1 / (1 + relativeIndex);

    // Add the weighted distance to the score
    score += weight * distance;

    // Penalize thumb general direction match
    if (i >= 1 && i <= 4) {
        const thumbDirection1 = {
        x: landmarks1[i].x - landmarks1[i - 1].x,
        y: landmarks1[i].y - landmarks1[i - 1].y
        };
        const thumbDirection2 = {
        x: landmarks2[i].x - landmarks2[i - 1].x,
        y: landmarks2[i].y - landmarks2[i - 1].y
        };

        // Dot product to measure similarity in direction
        const dotProduct = thumbDirection1.x * thumbDirection2.x + thumbDirection1.y * thumbDirection2.y;
        const magnitude1 = Math.sqrt(thumbDirection1.x * thumbDirection1.x + thumbDirection1.y * thumbDirection1.y);
        const magnitude2 = Math.sqrt(thumbDirection2.x * thumbDirection2.x + thumbDirection2.y * thumbDirection2.y);
        const directionSimilarity = dotProduct / (magnitude1 * magnitude2);

        // Penalize based on the difference in direction
        const directionPenalty = Math.pow(1 - directionSimilarity, 2);
        // console.log("Score: " + score);
        // console.log("Direction penalty: " + directionPenalty);
        score += directionPenalty * weight;
    }

    }

    return score;
}

function scoreToColor(score) {
    let maxScore = 0.35;
    score = Math.max(0, Math.min(maxScore, score));
    let value = score / maxScore;
    let green = Math.floor((1 - value) * 255);
    let red = Math.floor(value * 255);
    return `rgb(${red}, ${green}, 0)`;
}


export { transformLandmarks, flipLandmarks, scoreLandmarks, scoreToColor }