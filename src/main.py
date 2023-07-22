def func1(event, context):
    print("Hello from func1!")
    return {
        "statusCode": 200,
        "body": "Hello from func1!"
    }
